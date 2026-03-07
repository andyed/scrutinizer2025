# Wave 1: Color Search Validation Report

Generated: 2026-03-07
Parameters: rg_decay=0.072, yv_decay=0.014, supra=0.5
Geometry: fovea_radius=90px, ppd=45

## Tier 1: Must Pass

- [PASS] red composite retention monotonically decreases: 84.7% > 72.1% > 61.9% > 52.0% > 43.1%
- [PASS] green composite retention monotonically decreases: 87.1% > 76.6% > 68.0% > 59.6% > 51.9%
- [PASS] blue composite retention monotonically decreases: 94.6% > 89.6% > 84.8% > 79.4% > 73.5%
- [PASS] yellow composite retention monotonically decreases: 94.3% > 89.0% > 84.0% > 78.5% > 72.6%
- [PASS] BY retention >= 1.5x RG at ring 5: blue=73.5% / red=43.1% = 1.70x
- [SKIP] Rendered measurement agreement — no screenshots captured yet

## Tier 2: Should Pass

- [FAIL] BY/RG channel ratio vs Bowers at ~15°: model=2.15 (yv/rg retention) vs Bowers=2.72 (21% off, threshold=20%)
- [PASS] Green closer to red than blue: green-red gap=8.8pp, green-blue gap=21.6pp (threshold: <15pp and closer to red)
- [SKIP] Rendered vs model agreement — no screenshots captured yet

## Tier 3: Stretch

- [PASS] red model retention correlates with Hansen naming accuracy: r=1.000 (threshold: r>0.8)
- [PASS] blue model retention correlates with Hansen naming accuracy: r=1.000 (threshold: r>0.8)
- [PASS] BY always ranks above RG per ring: 20/20 correct (100%, threshold: >=90%)

## Summary

| Tier | Passed | Total | Status |
|------|--------|-------|--------|
| Tier 1 (must) | 5 | 5 | ALL PASS |
| Tier 2 (should) | 1 | 2 | 1 pass |
| Tier 3 (stretch) | 3 | 3 | ALL PASS |
