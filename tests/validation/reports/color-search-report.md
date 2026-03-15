# Wave 1: Color Search Validation Report

Generated: 2026-03-15
Parameters: rg_decay=0.054, yv_decay=0.014, supra=0.5
Geometry: fovea_radius=45px, ppd=45

## Tier 1: Must Pass

- [PASS] red composite retention monotonically decreases: 87.8% > 77.4% > 68.3% > 59.1% > 50.2%
- [PASS] green composite retention monotonically decreases: 89.5% > 80.4% > 72.5% > 64.5% > 56.6%
- [PASS] blue composite retention monotonically decreases: 94.6% > 89.6% > 84.8% > 79.4% > 73.5%
- [PASS] yellow composite retention monotonically decreases: 94.4% > 89.1% > 84.2% > 78.7% > 72.7%
- [FAIL] BY retention >= 1.5x RG at ring 5: blue=73.5% / red=50.2% = 1.46x
- [SKIP] Rendered measurement agreement — no screenshots captured yet

## Tier 2: Should Pass

- [FAIL] BY/RG channel ratio vs Bowers at ~15°: model=1.66 (yv/rg retention) vs Bowers=2.72 (39% off, threshold=20%)
- [PASS] Green closer to red than blue: green-red gap=6.3pp, green-blue gap=16.9pp (threshold: <15pp and closer to red)
- [SKIP] Rendered vs model agreement — no screenshots captured yet

## Tier 3: Stretch

- [PASS] red model retention correlates with Hansen naming accuracy: r=1.000 (threshold: r>0.8)
- [PASS] blue model retention correlates with Hansen naming accuracy: r=1.000 (threshold: r>0.8)
- [PASS] BY always ranks above RG per ring: 20/20 correct (100%, threshold: >=90%)

## Summary

| Tier | Passed | Total | Status |
|------|--------|-------|--------|
| Tier 1 (must) | 4 | 5 | FAILURES |
| Tier 2 (should) | 1 | 2 | 1 pass |
| Tier 3 (stretch) | 3 | 3 | ALL PASS |
