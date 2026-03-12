# Crowding Mode Comparison: Mode 0 vs Mode 10

Generated: 2026-03-12
Source: /Users/andyed/Documents/dev/scrutinizer-repo/scrutinizer2025/tests/golden-captures/v2.2

## Peripheral Crowding (>=6°, 28px column)

| Metric | Mode 0 | Mode 10 | Delta |
|--------|--------|---------|-------|
| Crowding ratio | 1.188 | 1.232 | +0.044 |
| Spread ratio | 0.962 | 1.136 | +0.174 |

## Luminance Structure (>=6°, 28px column)

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Oklab L variance ratio | 1.035 | Mode 10 preserves more luminance contrast |
| Chrom variance ratio | 0.906 | Both modes pool color similarly |
| Transition zone L ratio (3°) | 1.691 | Pooling path onset divergence (fovealRadius=2.37°, blendFactor≈0.33) |

## Hypothesis Results

- H1 (stronger crowding): FAIL
- H2 (more dispersion): PASS
- H3 (foveal preserved): FAIL
- H4a (mode 0 gradient): FAIL
- H4b (mode 10 gradient): FAIL
- H5 (L variance preserved): PASS — avg ratio 1.035 at >=6°
- H6 (chrom similar): PASS — avg ratio 0.906 at >=6°
