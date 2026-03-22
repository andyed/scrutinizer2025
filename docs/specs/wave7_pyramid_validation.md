# Wave 7: Pyramid Decomposition & TTM Synthesis Validation

> **Status:** Scaffolded (2026-03-22). Scripts created, awaiting Tier 2.75 captures.
> **Depends on:** Tier 2.75 code committed and mode 14 functional.
> **Phase mapping:** Corresponds to Phases 1c, 2b, 3c of `tier3_ttm_synthesis_plan.md`.

## Overview

Three sub-waves validating the Laplacian pyramid → statistics → synthesis pipeline:

| Sub-wave | What it validates | Scripts | Pass criteria |
|----------|------------------|---------|---------------|
| **7a** | Pyramid decomposition fidelity | `capture-pyramid-subbands.js`, `validate-pyramid.js` | Tier 1: reconstruction MSE < 0.005 |
| **7b** | Statistics extraction accuracy | `analyze-pyramid-stats.js` | Tier 1: band magnitude within 5% |
| **7c** | Crowding asymmetry (scientific milestone) | `capture-crowding-tier3.js`, `validate-crowding-tier3.js` | Tier 1: isolated recognized, flanked crowded |

## Wave 7a: Pyramid Fidelity

**Goal:** Verify WGSL Laplacian pyramid matches JS and pyrtools references.

### Checks

| ID | Tier | Check | Threshold | Method |
|----|------|-------|-----------|--------|
| 7a-1 | 1 (must) | Solid gray → near-zero bands | MSE < 0.001 | Synthetic 256×256 gray |
| 7a-2 | 1 (must) | Perfect reconstruction | MSE < 0.005 | sum(bands) + residual = original |
| 7a-3 | 2 (should) | WGSL vs JS reference per band | MSE < 0.005 | Compare captured band PNGs |
| 7a-4 | 2 (should) | JS vs pyrtools per band | MSE < 0.005 | Compare band outputs |
| 7a-5 | 3 (nice) | Energy conservation | ± 2% | sum(band energies) ≈ total |

### Run

```bash
# Generate references
python scripts/generate-pyramid-reference.py
node scripts/capture-pyramid-subbands.js

# Validate
npm run wave7a:validate
```

### Blog artifact

Tiled subband visualization — 4 band + residual decomposition of a web page screenshot. Caption: "What the peripheral visual system decomposes before pooling."

## Wave 7b: Statistics Accuracy

**Goal:** Verify per-tile summary statistics match pyrtools reference.

### Checks

| ID | Tier | Check | Threshold |
|----|------|-------|-----------|
| 7b-1 | 1 (must) | Mean magnitude per band per tile | Within 5% of reference (≥90% of tiles) |
| 7b-2 | 2 (should) | Cross-scale correlation sign | Matches reference (≥85% of tiles) |
| 7b-3 | 2 (should) | Correlation magnitude | Within 0.15 (≥80% of tiles) |
| 7b-4 | 3 (nice) | Marginal skewness | Within 0.2 (≥75% of tiles) |

### Run

```bash
python scripts/generate-pyramid-reference.py --stats
npm run wave7b:validate
```

### Blog artifact

Cross-scale correlation heatmap overlaid on original page. Hot = edges/text, cold = flat. Caption: "Where the visual system detects structure across spatial scales."

## Wave 7c: Crowding Asymmetry

**Goal:** Determine if synthesis-based rendering produces crowding asymmetry. This is the scientific milestone — simulation limitation #1 from `simulation-limitations.md`.

### Rationale

Displacement (Bender+Cutter) degrades isolated and flanked letters identically — each pixel is displaced independently regardless of neighbors. If summary-statistic pooling (Tier 2.75/3) degrades flanked letters MORE than isolated letters, the asymmetry is an emergent consequence of the pooling mechanism — not a tuned parameter.

### Checks

| ID | Tier | Check | Threshold |
|----|------|-------|-----------|
| 7c-1 | 1 (must) | Isolated letter at 8° recognized | OCR confidence ≥ 0.5 |
| 7c-2 | 1 (must) | Flanked letter at 8° fails | OCR confidence < 0.5 |
| 7c-3 | 2 (should) | Asymmetry ratio | isolated/flanked > 2× |
| 7c-4 | 3 (nice) | Critical spacing tracks Bouma | 0.5 × eccentricity ± 20% |

### Cross-mode comparison

The validation captures the same stimulus through three pipelines:
- **Mode 12** (displacement): Expected ratio ≈ 1.0 (no crowding mechanism)
- **Mode 10** (Tier 2.5): Expected ratio ≈ 1.0 (oriented noise, no cross-scale)
- **Mode 14** (Tier 2.75): Expected ratio > 2.0 (pooling produces crowding)

If mode 14 shows the asymmetry and mode 12 does not, the result is diagnostic.

### Run

```bash
node scripts/capture-crowding-tier3.js
npm run wave7c:validate
```

### Blog artifact

The money shot: same letter, same eccentricity, isolated vs flanked, through all three modes. Side-by-side strip.

## npm Scripts

```json
{
    "wave7a:validate": "node scripts/validate-pyramid.js",
    "wave7b:validate": "node scripts/analyze-pyramid-stats.js",
    "wave7c:capture": "node scripts/capture-crowding-tier3.js",
    "wave7c:validate": "node scripts/validate-crowding-tier3.js",
    "wave7": "npm run wave7a:validate && npm run wave7b:validate && npm run wave7c:capture && npm run wave7c:validate"
}
```

## Dependencies

| Script | Requires |
|--------|----------|
| `capture-pyramid-subbands.js` | Mode 14 functional, `webgpu-pyramid-compute.js` committed |
| `validate-pyramid.js` | JS pyramid reference (self-contained), pyrtools optional |
| `analyze-pyramid-stats.js` | WGSL stats readback JSON, pyrtools stats JSON |
| `capture-crowding-tier3.js` | `crowding-stimulus.html` reference page |
| `validate-crowding-tier3.js` | Tesseract (optional, has contrast-heuristic fallback) |

## Verification

After implementation, run all waves to confirm no regressions:

```bash
npm test                    # Unit tests (274+)
npm run validate-congestion # Wave 1-5
npm run wave6               # COCO-Periph
npm run wave7               # Pyramid + crowding
```
