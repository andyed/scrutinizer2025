# Crowding Mode Comparison: Mode 0 vs Mode 10

Generated: 2026-03-13
Source: /Users/andyed/Documents/dev/scrutinizer-repo/scrutinizer2025/tests/golden-captures/v2.3

## Peripheral Crowding (>=6°, 28px column)

| Metric | Mode 0 | Mode 10 | Delta |
|--------|--------|---------|-------|
| Crowding ratio | 0.914 | 0.888 | -0.026 |
| Spread ratio | 0.951 | 1.093 | +0.141 |

## Luminance Structure (>=6°, 28px column)

| Metric | Value | Interpretation |
|--------|-------|----------------|
| Oklab L variance ratio | 1.028 | Mode 10 preserves more luminance contrast |
| Chrom variance ratio | 0.901 | Both modes pool color similarly |
| Transition zone L ratio (3°) | 1.131 | Pooling path onset divergence (fovealRadius=2.37°, blendFactor≈0.33) |

## Hypothesis Results

- H1 (stronger crowding): PASS
- H2 (more dispersion): PASS
- H3 (foveal preserved): PASS
- H4a (mode 0 gradient): PASS
- H4b (mode 10 gradient): PASS
- H5 (L variance preserved): PASS — avg ratio 1.028 at >=6°
- H6 (chrom similar): PASS — avg ratio 0.901 at >=6°
