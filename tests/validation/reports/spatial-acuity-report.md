# Wave 2: Spatial Acuity Validation Report

Generated: 2026-04-12
Parameters: rg_decay=0.085, yv_decay=0.014, supra=0.5
Geometry: fovea_radius=45px, ppd=45

## Tier 1: Must Pass

- [PASS] Ring 1: frequency ordering preserved (4cpd=0%, 2cpd=68%, 1cpd=100%, 0.5cpd=100%, 0.25cpd=100%)
- [PASS] Ring 2: frequency ordering preserved (4cpd=0%, 2cpd=0%, 1cpd=100%, 0.5cpd=100%, 0.25cpd=100%)
- [PASS] Ring 3: frequency ordering preserved (4cpd=0%, 2cpd=0%, 1cpd=100%, 0.5cpd=100%, 0.25cpd=100%)
- [PASS] Ring 4: frequency ordering preserved (4cpd=0%, 2cpd=0%, 1cpd=96%, 0.5cpd=100%, 0.25cpd=100%)
- [PASS] Ring 5: frequency ordering preserved (4cpd=0%, 2cpd=0%, 1cpd=0%, 0.5cpd=100%, 0.25cpd=100%)
- [PASS] band0: monotonic decrease (0% >= 0% >= 0% >= 0% >= 0%)
- [PASS] band1: monotonic decrease (0% >= 0% >= 0% >= 0% >= 0%)
- [PASS] band2: monotonic decrease (0% >= 0% >= 0% >= 0% >= 0%)
- [PASS] band3: monotonic decrease (68% >= 0% >= 0% >= 0% >= 0%)
- [PASS] residual: monotonic decrease (100% >= 100% >= 100% >= 100% >= 100%)
- [PASS] Residual band >90% at all rings (min=100.0%)
- [SKIP] Measured contrast monotonicity — no screenshots captured yet

## Tier 2: Should Pass

- [PASS] band0 cutoff: expected=0.15, actual=0.15 (0% off, threshold=30%)
- [PASS] band1 cutoff: expected=0.45, actual=0.45 (0% off, threshold=30%)
- [PASS] band2 cutoff: expected=1.05, actual=1.05 (0% off, threshold=30%)
- [PASS] band3 cutoff: expected=2.25, actual=2.25 (0% off, threshold=30%)
- [PASS] Achromatic >= BY >= RG at ring 3 band3: achrom=0.0%, by=0.0%, rg=0.0%
- [SKIP] Rendered vs model agreement — no screenshots captured yet

## Tier 3: Stretch

- [FAIL] Composite spatial sensitivity correlates with Rovamo & Virsu: r=0.000 (threshold: r>0.9)
- [INFO] band3 (0.5cpd) per-band r=0.000 (not scored — step function vs smooth curve)
- [INFO] band2 (1cpd) per-band r=-1.000 (not scored — step function vs smooth curve)
- [INFO] band1 (2cpd) per-band r=-1.000 (not scored — step function vs smooth curve)
- [INFO] band0 (4cpd) per-band r=-1.000 (not scored — step function vs smooth curve)

## Summary

| Tier | Passed | Total | Status |
|------|--------|-------|--------|
| Tier 1 (must) | 11 | 11 | ALL PASS |
| Tier 2 (should) | 5 | 5 | ALL PASS |
| Tier 3 (stretch) | 0 | 1 | 0 pass |
