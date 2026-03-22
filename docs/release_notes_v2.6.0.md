# Scrutinizer v2.6.0 — Isotropic Cortical Sampling

**Date:** 2026-03-19
**Blog post:** [Isotropic Cortical Sampling](https://andyed.github.io/scrutinizer-www/blog/2026-03-21-v2.6.html)

Scrutinizer's default mode now derives its peripheral distortion profile from the FOVI cortical magnification model (Blauch, Alvarez & Konkle 2026). Seven rendering approaches failed before the eighth succeeded: sector geometry drives *where and how fast* degradation changes — not how pixels change.

## Highlights

### FOVI Cortical Grid (Default)

The displacement pipeline is now parameterized by cortical sector extent derived from `w = log(r + a)`. Noise frequency scales inversely with sector size; scramble cell size tracks sector extent (capped at 12px). The visual difference from the previous default is subtle — fewer implausible long-range pixel scatters, smoother degradation profile — but the derivation is now principled and traceable to Blauch's formulation.

- 19-test geometry suite validates math against Blauch's Python to 3 decimal places
- [Interactive grid comparison (CodePen)](https://codepen.io/andy-edmonds/pen/019ced00-b472-7c33-8ebb-20982aa039ad)
- [Cortical manifold visualization](https://andyed.github.io/scrutinizer-www/reference-pages/cortical-manifold.html)
- [Grid comparison](https://andyed.github.io/scrutinizer-www/reference-pages/grid-comparison.html)

### Bender/Cutter Extraction

V1 displacement components extracted as parameterized GLSL structs (`BenderConfig`, `CutterConfig`). Researchers can swap implementations by constructing different configs. Type 1 (Shredder) refactored to delegate — behavior-identical.

### Gradient Halo Fix

DoG band reconstruction artifacts on smooth gradients ("the halo") eliminated via smooth-content detection. When `pooledCol ≈ foveaCol`, the pipeline snaps to the source color — no Mach bands to amplify. V4 transitions restored to pixel-space.

### Citation Audit

AI-confabulated paper titles, authors, and article numbers corrected across 8 files. Findings: 12% of BibTeX entries had issues, 1 complete fabrication, 5 partial confabulations. [citation-guardian](https://github.com/andyed/citation-guardian) tool built to detect this class of error.

## New Files

| File | Purpose |
|------|---------|
| `scripts/validate-isotropic-rendering.js` | 12-check rendering validation suite |
| `docs/specs/mode_graduation.md` | Process spec for promoting modes to default |
| `docs/drafts/blauch-update-2026-03-19.md` | Draft correspondence re: FOVI adoption |

## Test Results

| Suite | Result |
|-------|--------|
| Unit (274) | PASS |
| Visual regression | PASS |
| Memory | PASS |
| Performance | PASS (+0.7ms worst p95) |
| Integration | PASS |
| Smoke (7) | PASS |
| Golden (73) | PASS |
| Isotropic rendering (12) | PASS |
| Subband entropy | 4/5 (pre-existing) |
| OCR | Needs recalibration for mode 12 |

## Post-Release Fixes (2026-03-19 → 2026-03-22)

### Code
- **Scrollbar protection bypass**: Scrollbar detection now bypasses the full pipeline (not just the memory mask), preventing peripheral distortion from bleeding into native scrollbar rendering.
- **Foveal radius menu**: Removed separator elements from the foveal radius radio group for cleaner menu layout.

### Documentation
- ArXiv paper: Reframed as "Restricted Focus Viewer," 25% trim, 4 empirical claim corrections, citation audit fixes.
- Science agent (`scripts/science-agent/`) added for automated citation validation.
- Reading span (Rayner 1998) added to simulation limitations; limitations section reframed.
- Mongrel textures spec rewritten as architectural plan with Tier 3 synthesis path.
- ROADMAP condensed from narrative to table format.

## Breaking Changes

- Default mode changed from 10 (Compute Mongrel) to 12 (FOVI Cortical Grid)
- FOVI blog post (2026-02-28) unpublished pending citation corrections
