# Wave 3: Crowding Geometry Validation Report

Generated: 2026-03-16
Parameters: fovea_radius=90px, ppd=45.0, cmf_a=2.78, radial_bias=2

## Tier 1: Must Pass

- [FAIL] Crowding ratio < 0.8 at 6° and 10° (6°=1.256, 10°=0.962)
- [PASS] MIP pooling proportional scaling (spread=1.71x, threshold <3.0x)
- [PASS] Radial bias ≥ 1.5:1 (u_crowding_radial_bias=2)

## Tier 2: Should Pass

- [PASS] Bouma ratio within range (mean=0.0287, range 0.015–1.5)
- [FAIL] Density gate separation (3°=0.827, 10°=0.962, delta=-0.135, threshold ≥0.15)
- [PASS] R:T asymmetry 2.00:1 (range 1.5–2.5:1, Toet & Levi ~2:1)

## Tier 3: Stretch

- [FAIL] Size independence (3°:CV=0.184, 6°:CV=0.086, 10°:CV=0.544, threshold CV<0.3)
- [SKIP] Stimulus-specific crowding — stimulus captures not found
- [SKIP] Bouma transition sigmoid — spacing captures not found

## Summary

| Tier | Passed | Total | Status |
|------|--------|-------|--------|
| Tier 1 (must) | 2 | 3 | FAILURES |
| Tier 2 (should) | 2 | 3 | 2 pass |
| Tier 3 (stretch) | 0 | 3 | 0 pass |
