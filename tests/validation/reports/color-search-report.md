# Wave 1: Color Search Validation Report

Generated: 2026-03-17
Parameters: rg_decay=0.085, yv_decay=0.014, supra=0.5
Geometry: fovea_radius=45px, ppd=45

## Tier 1: Must Pass

- [PASS] red composite retention monotonically decreases: 82.5% > 68.7% > 57.8% > 47.9% > 39.4%
- [PASS] green composite retention monotonically decreases: 85.5% > 74.1% > 65.2% > 56.9% > 49.6%
- [PASS] blue composite retention monotonically decreases: 94.6% > 89.6% > 84.8% > 79.4% > 73.5%
- [PASS] yellow composite retention monotonically decreases: 94.2% > 88.9% > 83.9% > 78.4% > 72.5%
- [PASS] BY retention >= 1.5x RG at ring 5: blue=73.5% / red=39.4% = 1.86x
- [PASS] red measured retention monotonically decreases
- [PASS] green measured retention monotonically decreases
- [PASS] blue measured retention monotonically decreases
- [PASS] yellow measured retention monotonically decreases

## Tier 2: Should Pass

- [PASS] BY/RG channel ratio vs Bowers (ring 5, 12.44°): model=2.59 (yv/rg retention) vs Bowers=2.72 at 15° (5% off, threshold=20%)
- [PASS] Green closer to red than blue: green-red gap=10.2pp, green-blue gap=23.9pp (threshold: <15pp and closer to red)
- [FAIL] Rendered matches model within 15%: 5/20 (25%)

## Tier 3: Stretch

- [PASS] red model retention correlates with Hansen naming accuracy: r=1.000 (threshold: r>0.8)
- [PASS] blue model retention correlates with Hansen naming accuracy: r=1.000 (threshold: r>0.8)
- [PASS] BY always ranks above RG per ring: 20/20 correct (100%, threshold: >=90%)

## Summary

| Tier | Passed | Total | Status |
|------|--------|-------|--------|
| Tier 1 (must) | 9 | 9 | ALL PASS |
| Tier 2 (should) | 2 | 3 | 2 pass |
| Tier 3 (stretch) | 3 | 3 | ALL PASS |
